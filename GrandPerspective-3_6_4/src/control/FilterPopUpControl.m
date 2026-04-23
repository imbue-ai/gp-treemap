/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "FilterPopUpControl.h"

#import "FilterRepository.h"
#import "UniqueTagsTransformer.h"
#import "NotifyingDictionary.h"

#import "PreferencesPanelControl.h"


NSString  *SelectedFilterRenamed = @"selectedFilterRenamed";
NSString  *SelectedFilterRemoved = @"selectedFilterRemoved";
NSString  *SelectedFilterUpdated = @"selectedFilterUpdated";


@interface FilterPopUpControl (PrivateMethods)

- (void) filterAddedToRepository:(NSNotification *)notification;
- (void) filterRemovedFromRepository:(NSNotification *)notification;
- (void) filterUpdatedInRepository:(NSNotification *)notification;
- (void) filterRenamedInRepository:(NSNotification *)notification;

@end


@implementation FilterPopUpControl

- (instancetype) initWithPopUpButton:(NSPopUpButton *)popUpButtonVal {
  return [self initWithPopUpButton: popUpButtonVal
                  filterRepository: FilterRepository.defaultFilterRepository];
}

- (instancetype) initWithPopUpButton:(NSPopUpButton *)popUpButtonVal
                    filterRepository:(FilterRepository *)filterRepositoryVal {
  return [self initWithPopUpButton: popUpButtonVal
                  filterRepository: filterRepositoryVal
                        noneOption: NO];
}

- (instancetype) initWithPopUpButton:(NSPopUpButton *)popUpButtonVal
                    filterRepository:(FilterRepository *)filterRepositoryVal
                          noneOption:(BOOL)addNoneOption {
  if (self = [super init]) {
    popUpButton = [popUpButtonVal retain];
    filterRepository = [filterRepositoryVal retain];
    tagMaker = [UniqueTagsTransformer.defaultUniqueTagsTransformer retain];
    notificationCenter = [NSNotificationCenter.defaultCenter retain];
    
    NotifyingDictionary  *repositoryFiltersByName = 
      filterRepository.filtersByNameAsNotifyingDictionary;
    NSNotificationCenter  *nc = repositoryFiltersByName.notificationCenter;
    
    [nc addObserver: self
           selector: @selector(filterAddedToRepository:)
               name: ObjectAddedEvent
             object: repositoryFiltersByName];
    [nc addObserver: self
           selector: @selector(filterRemovedFromRepository:)
               name: ObjectRemovedEvent
             object: repositoryFiltersByName];
    [nc addObserver: self
           selector: @selector(filterUpdatedInRepository:)
               name: ObjectUpdatedEvent
             object: repositoryFiltersByName];
    [nc addObserver: self
           selector: @selector(filterRenamedInRepository:)
               name: ObjectRenamedEvent
             object: repositoryFiltersByName];

    [popUpButton removeAllItems];
    [tagMaker addLocalisedNamesFor: filterRepository.filtersByName.allKeys
                           toPopUp: popUpButton
                            select: nil
                             table: @"Names"];

    if (addNoneOption) {
      [tagMaker addLocalisedNameFor: NoneFilter
                            toPopUp: popUpButton
                             select: NO
                              table: @"Names"];
    }
  }
  return self;
}

- (void) dealloc {
  NSNotificationCenter  *nc =
    filterRepository.filtersByNameAsNotifyingDictionary.notificationCenter;
  [nc removeObserver: self];

  [popUpButton release];
  [filterRepository release];
  [tagMaker release];
  [notificationCenter release];
  
  [super dealloc];
}


- (NSNotificationCenter*) notificationCenter {
  return notificationCenter;
}
  
- (void) setNotificationCenter:(NSNotificationCenter *)notificationCenterVal {
  if (notificationCenterVal != notificationCenter) {
    [notificationCenter release];
    notificationCenter = [notificationCenterVal retain];
  }
}


- (NSString *)selectedFilterName {
  return [tagMaker nameForTag: popUpButton.selectedItem.tag];
}

- (void) selectFilterNamed:(NSString *)name {
  NSUInteger  tag = [tagMaker tagForName: name];
  [popUpButton selectItemAtIndex: [popUpButton indexOfItemWithTag: tag]];
}

@end // @implementation FilterPopUpControl


@implementation FilterPopUpControl (PrivateMethods)

- (void) filterAddedToRepository:(NSNotification *)notification {
  NSString  *name = notification.userInfo[@"key"];
  
  [tagMaker addLocalisedNameFor: name toPopUp: popUpButton select: NO table: @"Names"];
}

- (void) filterRemovedFromRepository:(NSNotification *)notification {
  NSString  *name = notification.userInfo[@"key"];
  NSUInteger  tag = [tagMaker tagForName: name];
  NSUInteger  index = [popUpButton indexOfItemWithTag: tag];
  BOOL  wasSelected = popUpButton.indexOfSelectedItem == index;

  [popUpButton removeItemAtIndex: [popUpButton indexOfItemWithTag: tag]];
  
  if (wasSelected) {
    [notificationCenter postNotificationName: SelectedFilterRemoved object: self];
  }
}

- (void) filterUpdatedInRepository:(NSNotification *)notification {
  NSString  *name = notification.userInfo[@"key"];
  NSUInteger  tag = [tagMaker tagForName: name];
  NSUInteger  index = [popUpButton indexOfItemWithTag: tag];
  BOOL  isSelected = popUpButton.indexOfSelectedItem == index;

  if (isSelected) {
    [notificationCenter postNotificationName: SelectedFilterUpdated object: self];
  }
}

- (void) filterRenamedInRepository:(NSNotification *)notification {
  NSString  *oldName = notification.userInfo[@"oldkey"];
  NSString  *newName = notification.userInfo[@"newkey"];
  NSUInteger  tag = [tagMaker tagForName: oldName];
  NSUInteger  index = [popUpButton indexOfItemWithTag: tag];
  BOOL  wasSelected = popUpButton.indexOfSelectedItem == index;
  
  [popUpButton removeItemAtIndex: index];
  [tagMaker addLocalisedNameFor: newName toPopUp: popUpButton select: wasSelected table: @"Names"];

  if (wasSelected) {
    [notificationCenter postNotificationName: SelectedFilterRenamed object: self];
  }
}

@end // @implementation FilterPopUpControl (PrivateMethods)
