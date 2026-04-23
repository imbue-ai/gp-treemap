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

#import <Cocoa/Cocoa.h>

@class WindowManager;
@class VisibleAsynchronousTaskManager;
@class FiltersWindowControl;
@class UniformTypeRankingWindowControl;
@class FilterSelectionPanelControl;
@class PreferencesPanelControl;
@class StartWindowControl;
@class ExportAsTextDialogControl;

@interface MainMenuControl : NSObject<NSMenuItemValidation> {
  WindowManager  *windowManager;
  
  VisibleAsynchronousTaskManager  *scanTaskManager;
  VisibleAsynchronousTaskManager  *filterTaskManager;
  VisibleAsynchronousTaskManager  *rawWriteTaskManager;
  VisibleAsynchronousTaskManager  *xmlWriteTaskManager;
  VisibleAsynchronousTaskManager  *xmlReadTaskManager;

  StartWindowControl  *startWindowControl;
  PreferencesPanelControl  *preferencesPanelControl;
  FilterSelectionPanelControl  *filterSelectionPanelControl;
  FiltersWindowControl  *filtersWindowControl;
  UniformTypeRankingWindowControl  *uniformTypeWindowControl;
  ExportAsTextDialogControl  *exportAsTextDialogControl;
  
  BOOL  showWelcomeWindow;
  // The number of open directory view windows
  int  viewCount;
  // The number of running view-producing tasks
  int  viewTaskCount;
}

@property (class, nonatomic, readonly) MainMenuControl *singletonInstance;

@property (class, nonatomic, readonly) NSArray *rescanActionNames;
@property (class, nonatomic, readonly) NSArray *rescanBehaviourNames;
@property (class, nonatomic, readonly) NSArray *noViewsBehaviourNames;

+ (void) reportUnboundFilters:(NSArray *)unboundFilters;
+ (void) reportUnboundTests:(NSArray *)unboundTests;

- (IBAction) scanDirectoryView:(id)sender;
- (IBAction) scanFilteredDirectoryView:(id)sender;

// Refresh entire scan tree (based on changes reported by FSEvent)
- (IBAction) refresh:(id)sender;

// Default rescan action
- (IBAction) rescan:(id)sender;

// Rescan entire scan tree
- (IBAction) rescanAll:(id)sender;

// Rescan visible tree
- (IBAction) rescanVisible:(id)sender;

// Rescan selected item (file or directory)
- (IBAction) rescanSelected:(id)sender;

// Rescan the entire scan tree, with the current mask as a filter
- (IBAction) rescanWithMaskAsFilter:(id)sender;

- (IBAction) filterDirectoryView:(id)sender;
- (IBAction) duplicateDirectoryView:(id)sender;
- (IBAction) twinDirectoryView:(id)sender;

// Saves and loads XML scan data
- (IBAction) saveScanData:(id)sender;
- (IBAction) loadScanData:(id)sender;

// Saves scan data as text
- (IBAction) saveScanDataAsText:(id)sender;

- (IBAction) saveDirectoryViewImage:(id)sender;

- (IBAction) editPreferences:(id)sender;
- (IBAction) editFilters:(id)sender;
- (IBAction) editUniformTypeRanking:(id)sender;

- (IBAction) toggleToolbarShown:(id)sender;
- (IBAction) customizeToolbar:(id)sender;

- (IBAction) toggleControlPanelShown:(id)sender;

- (IBAction) openWebsite:(id)sender;

- (void) scanFolder:(NSString *)path;

@end
