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

#import "FilterSelectionPanelControl.h"

#import "NamedFilter.h"
#import "FilterRepository.h"
#import "FilterEditor.h"
#import "FilterPopUpControl.h"


@interface FilterSelectionPanelControl (PrivateMethods)

@property (nonatomic, readonly, strong) FilterEditor *filterEditor;

@end // @interface FilterSelectionPanelControl


@implementation FilterSelectionPanelControl

- (instancetype) init {
  return [self initWithFilterRepository: FilterRepository.defaultFilterRepository];
}

- (instancetype) initWithFilterRepository:(FilterRepository *)filterRepositoryVal {
  if (self = [super initWithWindow: nil]) {
    filterRepository = [filterRepositoryVal retain];

    filterEditor = nil; // Load it lazily
  }
  return self;
}

- (void) dealloc {
  [filterRepository release];
  [filterEditor release];
  [filterPopUpControl release];

  [super dealloc];
}


- (NSString *)windowNibName {
  return @"FilterSelectionPanel";
}

- (void) windowDidLoad {
  filterPopUpControl = [[FilterPopUpControl alloc] initWithPopUpButton: filterPopUp
                                                      filterRepository: filterRepository
                                                            noneOption: YES];
}

- (IBAction) editFilter:(id)sender {
  [self filterEditor];
  NSString  *oldName = filterPopUpControl.selectedFilterName;
  [filterEditor editFilterNamed: oldName];
}

- (IBAction) addFilter:(id)sender {
  [self filterEditor];
  NamedFilter  *newFilter = [filterEditor createNamedFilter];
  [self selectFilterNamed: newFilter.name];
}

- (IBAction) okAction:(id)sender {
  [NSApp stopModal];
}

- (IBAction) cancelAction:(id)sender {
  [NSApp abortModal];
}


- (void) selectFilterNamed:(NSString *)name {
  return [filterPopUpControl selectFilterNamed: name];
}

- (NamedFilter *)selectedNamedFilter {
  NSString  *name = filterPopUpControl.selectedFilterName;

  if ([name isEqualToString: NoneFilter]) {
    // User selected "no filter". This can be useful if the user has configured a scan filter in the
    // preferences and wants to scan without this filter without changing the preferences.
    return nil;
  }

  Filter  *filter = filterRepository.filtersByName[name];
  // Filter should always exist, as pop-up control is observing the filter repository.
  NSAssert(filter != nil, @"Unexpected nil filter");

  return [NamedFilter namedFilter: filter name: name];
}

- (void) enableApplyDefaultFilterOption:(BOOL)enable {
  applyDefaultFilterCheckbox.state = enable ? NSControlStateValueOn : NSControlStateValueOff;
  applyDefaultFilterCheckbox.enabled = enable;
}

- (BOOL) applyDefaultFilter {
  return applyDefaultFilterCheckbox.state == NSControlStateValueOn;
}

@end // @implementation FilterSelectionPanelControl


@implementation FilterSelectionPanelControl (PrivateMethods)

- (FilterEditor *)filterEditor {
  if (filterEditor == nil) {
    filterEditor = [[FilterEditor alloc] initWithFilterRepository: filterRepository];
  }
  return filterEditor;
}

@end // @implementation FilterSelectionPanelControl (PrivateMethods)
